export default function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  children,
  canExpand = true,
  deniedMessage = 'You do not have permission to expand this section.',
}) {
  return (
    <section className="collapsible-section">
      <button type="button" className="section-toggle" onClick={onToggle} disabled={!canExpand}>
        <span>{title}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {!canExpand && <div className="section-denied">{deniedMessage}</div>}
      {isOpen && <div className="section-content">{children}</div>}
    </section>
  )
}
