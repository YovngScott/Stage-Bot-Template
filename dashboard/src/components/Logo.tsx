/** Isotipo genérico (círculo + rayo), en blanco sobre fondo oscuro. Reemplázalo por el logo real del cliente si quieres. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Logo">
      <circle cx="50" cy="50" r="49" fill="#000" stroke="var(--border)" />
      <path
        d="M55 20 L32 55 L48 55 L45 80 L70 45 L53 45 Z"
        fill="#fff"
      />
    </svg>
  );
}
