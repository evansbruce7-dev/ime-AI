import { Switch } from "@base-ui/react/switch";

type EliteSwitchProps = {
  /** Accessible name, also logged when the value changes. */
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * Settings toggle built on Base UI Switch.
 * The track is a physical capsule: inset highlight on top, gold fill when on.
 */
export function EliteSwitch({ label, checked, disabled = false, onCheckedChange }: EliteSwitchProps) {
  return (
    <Switch.Root
      checked={checked}
      disabled={disabled}
      aria-label={label}
      className="elite-switch"
      onCheckedChange={(next) => {
        console.log("[atelier] switch", label, "→", next);
        onCheckedChange(next);
      }}
    >
      <Switch.Thumb className="elite-switch-thumb" />
    </Switch.Root>
  );
}
