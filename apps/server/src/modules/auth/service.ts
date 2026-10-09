import { randomBytes } from 'node:crypto';
import type { Role } from '@pos/core';
import { stores, tenants, users, type PosDb } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { hashPin, verifyPin } from './pin.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 5 * 60 * 1000;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

export type AuthErrorCode = 'invalid_credentials' | 'locked' | 'setup_done';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    /** Milisegundos restantes de bloqueo, si aplica. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  tenantId: string;
  storeId: string;
}

interface Session {
  user: SessionUser;
  expiresAt: number;
}

export interface SetupInput {
  tenantName: string;
  storeName: string;
  adminName: string;
  pin: string;
}

export class AuthService {
  private readonly sessions = new Map<string, Session>();
  /** Intentos fallidos de aprobación con PIN de admin (en memoria). */
  private approvalFailures = { count: 0, lockedUntil: 0 };

  constructor(
    private readonly db: PosDb,
    private readonly now: () => number = Date.now,
  ) {}

  needsSetup(): boolean {
    return this.db.select({ id: tenants.id }).from(tenants).limit(1).all().length === 0;
  }

  /** Crea negocio, tienda y primer admin. Solo funciona una vez. */
  async setup(input: SetupInput): Promise<SessionUser> {
    if (!this.needsSetup()) throw new AuthError('setup_done', 'El sistema ya está configurado.');
    const pinHash = await hashPin(input.pin);
    return this.db.transaction((tx) => {
      const [tenant] = tx.insert(tenants).values({ name: input.tenantName }).returning().all();
      const [store] = tx
        .insert(stores)
        .values({ tenantId: tenant!.id, name: input.storeName })
        .returning()
        .all();
      const [admin] = tx
        .insert(users)
        .values({
          tenantId: tenant!.id,
          storeId: store!.id,
          name: input.adminName,
          role: 'admin',
          pinHash,
        })
        .returning()
        .all();
      return toSessionUser(admin!);
    });
  }

  listActiveUsers(): { id: string; name: string }[] {
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.active, true))
      .all();
  }

  async createUser(
    actor: SessionUser,
    input: { name: string; role: Role; pin: string },
  ): Promise<SessionUser> {
    const pinHash = await hashPin(input.pin);
    const [created] = this.db
      .insert(users)
      .values({
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        name: input.name,
        role: input.role,
        pinHash,
      })
      .returning()
      .all();
    return toSessionUser(created!);
  }

  async login(userId: string, pin: string): Promise<{ token: string; user: SessionUser }> {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    // Mismo mensaje para usuario inexistente/inactivo y PIN incorrecto.
    if (!row || !row.active) {
      throw new AuthError('invalid_credentials', 'Usuario o PIN incorrectos.');
    }

    const now = this.now();
    if (row.lockedUntil && row.lockedUntil > now) {
      throw new AuthError('locked', 'Usuario bloqueado temporalmente.', row.lockedUntil - now);
    }

    if (!(await verifyPin(pin, row.pinHash))) {
      const attempts = row.failedAttempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      this.db
        .update(users)
        .set({
          failedAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? now + LOCK_MS : null,
          updatedAt: now,
        })
        .where(eq(users.id, row.id))
        .run();
      if (lock) {
        throw new AuthError('locked', 'Demasiados intentos. Usuario bloqueado.', LOCK_MS);
      }
      throw new AuthError('invalid_credentials', 'Usuario o PIN incorrectos.');
    }

    this.db
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, row.id))
      .run();

    const user = toSessionUser(row);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { user, expiresAt: now + SESSION_IDLE_MS });
    return { token, user };
  }

  /** Devuelve el usuario de la sesión y renueva su vigencia. */
  authenticate(token: string | undefined): SessionUser | undefined {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    const now = this.now();
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return undefined;
    }
    session.expiresAt = now + SESSION_IDLE_MS;
    return session.user;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  /**
   * Aprobación con PIN de admin (cancelaciones, descuentos sobre umbral).
   * Devuelve al admin que aprobó, o undefined. Se bloquea tras demasiados fallos.
   */
  async approveWithAdminPin(actor: SessionUser, pin: string): Promise<SessionUser | undefined> {
    const now = this.now();
    if (this.approvalFailures.lockedUntil > now) {
      throw new AuthError(
        'locked',
        'Aprobación bloqueada temporalmente.',
        this.approvalFailures.lockedUntil - now,
      );
    }

    const admins = this.db
      .select()
      .from(users)
      .where(and(eq(users.storeId, actor.storeId), eq(users.role, 'admin'), eq(users.active, true)))
      .all();
    for (const admin of admins) {
      if (await verifyPin(pin, admin.pinHash)) {
        this.approvalFailures = { count: 0, lockedUntil: 0 };
        return toSessionUser(admin);
      }
    }

    const count = this.approvalFailures.count + 1;
    this.approvalFailures =
      count >= MAX_FAILED_ATTEMPTS
        ? { count: 0, lockedUntil: now + LOCK_MS }
        : { count, lockedUntil: 0 };
    return undefined;
  }
}

function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tenantId: row.tenantId,
    storeId: row.storeId,
  };
}
