export default function Logo({ size = 38, light = false }) {
  return (
    <div className="logo">
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Zeek Power">
        <rect width="48" height="48" rx="13" fill="#0f1a2b"/>
<g transform="translate(24 18)">
<g stroke="#e4ee00" strokeWidth="1.7" strokeLinecap="round" opacity=".9"><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(0)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(30)"/><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(60)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(90)"/><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(120)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(150)"/><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(180)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(210)"/><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(240)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(270)"/><line x1="0" y1="-13.8" x2="0" y2="-16.6" transform="rotate(300)"/><line x1="0" y1="-13.8" x2="0" y2="-15.4" transform="rotate(330)"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite"/></g>
<circle r="12.2" fill="#e4ee00"><animate attributeName="opacity" values="1;.82;1" dur="3.2s" repeatCount="indefinite"/></circle>
<g fill="#0f1a2b"><path d="M0 0C-3-3-3.4-8.2 0-10.6 3.4-8.2 3-3 0 0Z" transform="rotate(0)"/><path d="M0 0C-3-3-3.4-8.2 0-10.6 3.4-8.2 3-3 0 0Z" transform="rotate(120)"/><path d="M0 0C-3-3-3.4-8.2 0-10.6 3.4-8.2 3-3 0 0Z" transform="rotate(240)"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="5s" repeatCount="indefinite"/></g>
<circle r="2.1" fill="#fff"/>
</g>
<path d="M17.5 36.2h13l-13 7h13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span className={'wordmark' + (light ? ' light' : '')}><b>Zeek</b> Power</span>
    </div>
  );
}
