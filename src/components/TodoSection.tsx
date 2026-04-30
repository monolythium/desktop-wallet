// Visual placeholder for stub pages. Each item renders as a TODO line —
// looks consistent, makes scope readable, and never lies about what's wired.

interface Props {
  title: string;
  items: string[];
}

export function TodoSection({ title, items }: Props) {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>{title}</h3>
        <span className="w-todo__pill">stub</span>
      </div>
      <div className="w-card__body">
        <ul className="w-todo__list">
          {items.map((line, i) => (
            <li key={i} className="w-todo__item">
              <span className="w-todo__bullet">·</span>
              <span className="w-todo__text">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
