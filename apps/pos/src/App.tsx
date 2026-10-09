import { useQuery } from '@tanstack/react-query';

interface Health {
  ok: boolean;
  service: string;
}

export function App() {
  const { data, isError } = useQuery<Health>({
    queryKey: ['health'],
    queryFn: async () => (await fetch('/api/health')).json(),
    refetchInterval: 5000,
  });

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Punto de Venta</h1>
      <p className={isError ? 'text-red-600' : data?.ok ? 'text-green-700' : 'text-gray-500'}>
        {isError ? 'Sin conexión con el servicio' : data?.ok ? 'Servicio en línea' : 'Conectando…'}
      </p>
    </main>
  );
}
