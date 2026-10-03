import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";

/**
 * Privacy statement. This page does not collect telemetry.
 */
export function PrivacyPage() {
  const { m } = useI18n();
  const copy = m.privacy;
  return (
    <div className="atelier-privacy">
      <PageIntro index="07" kicker={copy.kicker} title={copy.title} lede={copy.lede} />
      <div className="atelier-privacy-grid">
        <article className="atelier-principle">
          <p className="atelier-kicker">
            <em>01</em>
            <span>{copy.keyKicker}</span>
          </p>
          <h2>{copy.keyTitle}</h2>
          <p>{copy.keyBody}</p>
        </article>
        <article className="atelier-principle">
          <p className="atelier-kicker">
            <em>02</em>
            <span>{copy.pasteKicker}</span>
          </p>
          <h2>{copy.pasteTitle}</h2>
          <p>{copy.pasteBody}</p>
        </article>
        <article className="atelier-principle">
          <p className="atelier-kicker">
            <em>03</em>
            <span>{copy.inferKicker}</span>
          </p>
          <h2>{copy.inferTitle}</h2>
          <p>{copy.inferBody}</p>
        </article>
        <article className="atelier-principle">
          <p className="atelier-kicker">
            <em>04</em>
            <span>{copy.diagKicker}</span>
          </p>
          <h2>{copy.diagTitle}</h2>
          <p>{copy.diagBody}</p>
        </article>
      </div>
    </div>
  );
}
