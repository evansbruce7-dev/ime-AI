import type { SVGProps } from "react";

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.65,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconProps = SVGProps<SVGSVGElement>;

export function WorkspaceIconHome(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <path {...stroke} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-7H10v7H5a1 1 0 0 1-1-1v-9.5Z" />
    </svg>
  );
}

export function WorkspaceIconCommands(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <path fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" d="M10 7h10M10 12h10M10 17h10" />
      <circle cx="6" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WorkspaceIconModels(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <rect {...stroke} x="4" y="4" width="16" height="16" rx="2" />
      <path {...stroke} d="M9 9h6v6H9z" />
    </svg>
  );
}

export function WorkspaceIconBehavior(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <rect {...stroke} x="2" y="6" width="20" height="12" rx="2" />
      <path {...stroke} d="M6 10h.01M10 10h4" />
    </svg>
  );
}

export function WorkspaceIconPrivacy(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        {...stroke}
        d="M12 3 5 6v5c0 5 3.5 9 7 10 3.5-1 7-5 7-10V6l-7-3Z"
      />
    </svg>
  );
}

export function WorkspaceIconAppearance(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <circle {...stroke} cx="12" cy="12" r="3.5" />
      <path {...stroke} d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function WorkspaceIconStats(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <path {...stroke} d="M6 20V10M12 20V4M18 20v-6" />
    </svg>
  );
}

/** Stacked lines — processing queue settings tab. */
export function WorkspaceIconQueue(props: IconProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...props}>
      <path {...stroke} d="M5 7h14M5 12h14M5 17h10" />
    </svg>
  );
}
