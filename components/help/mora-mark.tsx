type MoraMarkProps = {
  className?: string;
};

// The berry is decorative: the enclosing button supplies the accessible name.
export function MoraMark({ className }: MoraMarkProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 64 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="#69338B" stroke="#51226F" strokeWidth="1.15">
        <circle cx="24" cy="23" r="12" />
        <circle cx="41" cy="23" r="12" />
        <circle cx="15" cy="37" r="11" />
        <circle cx="32" cy="37" r="12" />
        <circle cx="49" cy="37" r="11" />
        <circle cx="23" cy="52" r="11" />
        <circle cx="40" cy="52" r="11" />
        <circle cx="32" cy="61" r="8" />
      </g>
      <path
        d="M32 12C30 7 32 4 35 2"
        stroke="#286F4D"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <path
        d="M33 11C39 3 47 5 50 7C47 14 40 16 33 11Z"
        fill="#4DAA72"
        stroke="#286F4D"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M25 34H39M25 40H35"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
