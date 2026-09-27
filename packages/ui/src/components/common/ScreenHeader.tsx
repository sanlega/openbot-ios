import { createContext, useContext, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/** Set by the app shell: on phones, secondary screens get a Back button to the sidebar. */
export const ShellBackContext = createContext<(() => void) | null>(null);

interface ScreenHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps) {
  const back = useContext(ShellBackContext);
  return (
    <header className="screen-header">
      {back ? (
        <button type="button" className="icon-btn thread-back" onClick={back} aria-label="Back">
          <ChevronLeft size={18} />
        </button>
      ) : null}
      <div className="screen-header-text">
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="screen-actions">{actions}</div> : null}
    </header>
  );
}
