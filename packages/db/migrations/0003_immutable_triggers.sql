-- Tablas inmutables: corregir = registro nuevo. Se hace cumplir en la base de datos.
CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es inmutable'); END;
