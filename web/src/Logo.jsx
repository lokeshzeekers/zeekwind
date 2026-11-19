export default function Logo({ size = 38, light = false }) {
  const blade = 'M0 0C-4-4-4.5-11 0-14 4.5-11 4-4 0 0Z';
  return (
    <div className="logo">
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="13" fill="#0f1a2b" />
        <g transform="translate(24 17)">
          <g fill="#e4ee00">
            {[0, 120, 240].map((a) => <path key={a} d={blade} transform={`rotate(${a})`} />)}
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="12s" repeatCount="indefinite" />
          </g>
          <circle r="2.6" fill="#fff" />
        </g>
        <path d="M17.5 32.5h13l-13 8h13" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={'wordmark' + (light ? ' light' : '')}><b>Zeek</b>Wind</span>
    </div>
  );
}
