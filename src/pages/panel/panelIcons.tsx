/** Hollow bar-chart icon for the stats rail button (stroke only, matches other outline-style glyphs). */
export function IconStatsOutline() {
  return (
    <svg className="ime-icon-stroke" viewBox="0 0 24 24" width={20} height={20} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 20V10M12 20V4M18 20v-6"
      />
    </svg>
  );
}

/** Hollow “i in circle” for the about rail button. */
export function IconInfoOutline() {
  return (
    <svg className="ime-icon-stroke" viewBox="0 0 24 24" width={20} height={20} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.65" />
      <circle cx="12" cy="8" r="0.9" fill="none" stroke="currentColor" strokeWidth="1.65" />
      <path fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" d="M12 11v6" />
    </svg>
  );
}

/** Clock face for “recent input drafts” next to the theme label. */
export function IconInputHistory() {
  return (
    <svg className="ime-icon-stroke" viewBox="0 0 24 24" width={17} height={17} aria-hidden="true">
      <circle cx="12" cy="12" r="7.35" fill="none" stroke="currentColor" strokeWidth="1.65" />
      <path fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" d="M12 8.25v3.6l2.2 1.35" />
    </svg>
  );
}

/** Stacked list for the processing queue trigger (left of NEW). */
export function IconQueue() {
  return (
    <svg className="ime-icon-stroke" viewBox="0 0 24 24" width={17} height={17} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 7h14M5 12h14M5 17h10"
      />
    </svg>
  );
}

/** Plus-in-square for “new task” (replaces the NEW text chip). */
export function IconNewTask() {
  return (
    <svg className="ime-icon-stroke" viewBox="0 0 24 24" width={17} height={17} aria-hidden="true">
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
