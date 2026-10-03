type PageIntroProps = {
  /** Two-digit catalog index shown in the serif kicker. */
  index: string;
  /** Short section name beside the index. */
  kicker: string;
  title: string;
  lede: string;
};

/** Editorial page header shared by every settings section. */
export function PageIntro({ index, kicker, title, lede }: PageIntroProps) {
  return (
    <header className="atelier-intro">
      <p className="atelier-kicker">
        <em>{index}</em>
        <span>{kicker}</span>
      </p>
      <h1>{title}</h1>
      <p>{lede}</p>
    </header>
  );
}
