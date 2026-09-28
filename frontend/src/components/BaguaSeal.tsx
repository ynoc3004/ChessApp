/** Decorative eight-trigram seal, drawn as vectors so it remains crisp at any size. */
export default function BaguaSeal({ className }: { className?: string }) {
  const trigrams = ["111", "011", "101", "001", "000", "100", "010", "110"];

  return (
    <svg className={className} viewBox="0 0 320 320" aria-hidden="true" focusable="false">
      <g className="bagua-orbit">
        <circle cx="160" cy="160" r="152" fill="none" stroke="currentColor" strokeWidth="1" />
        <polygon points="102,20 218,20 300,102 300,218 218,300 102,300 20,218 20,102" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="160" cy="160" r="83" fill="none" stroke="currentColor" strokeWidth="1" />
        {trigrams.map((lines, index) => (
          <g key={lines} transform={`rotate(${index * 45} 160 160)`} fill="currentColor">
            {[...lines].map((line, row) =>
              line === "1" ? (
                <rect key={row} x="137" y={37 + row * 12} width="46" height="6" rx="1" />
              ) : (
                <g key={row}>
                  <rect x="137" y={37 + row * 12} width="19" height="6" rx="1" />
                  <rect x="164" y={37 + row * 12} width="19" height="6" rx="1" />
                </g>
              ),
            )}
          </g>
        ))}
      </g>

      <g className="bagua-core">
        <circle cx="160" cy="160" r="62" fill="#f7e6ca" stroke="currentColor" strokeWidth="2" />
        <path d="M160 98 A62 62 0 0 1 160 222 A31 31 0 0 1 160 160 A31 31 0 0 0 160 98" fill="currentColor" />
        <circle cx="160" cy="129" r="8" fill="currentColor" />
        <circle cx="160" cy="191" r="8" fill="#f7e6ca" />
      </g>
    </svg>
  );
}
