/** An on/off switch (`role="switch"`). Pass `label` for its accessible name when it has no visible label. */
export function Switch({ checked, onChange, disabled, label, dataAttrs }: { checked: boolean; onChange(checked: boolean): void; disabled?: boolean; label?: string; dataAttrs?: Record<`data-${string}`, string | boolean | undefined> }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // Off, the track is a visible grey on every surface (bg-border vanished on popovers and dialogs,
      // leaving a lone white dot); on, it is the yellow fill with a dark knob, like a primary button.
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-faint/40 hover:bg-faint/55'}`}
      {...dataAttrs}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-4 rounded-full shadow-sm transition-transform ${checked ? 'translate-x-4 bg-on-accent' : 'bg-white'}`}
        aria-hidden
      />
    </button>
  );
}

/** A labelled on/off switch, as in Settings. `attr` is the data- hook the smoke test clicks. */
export function Toggle({ label, detail, checked, attr, onChange, disabled }: { label: string; detail: string; checked: boolean; attr: string; onChange(checked: boolean): void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4" data-setting-row>
      <span>
        <span className="block text-ui">{label}</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} dataAttrs={{ [attr as `data-${string}`]: true }} />
    </label>
  );
}
