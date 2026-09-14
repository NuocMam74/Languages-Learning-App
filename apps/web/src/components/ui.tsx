import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Écran une colonne, action principale en bas, à portée de pouce (spec §13). */
export function Screen({ children, action, top }: { children: ReactNode; action?: ReactNode; top?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]">
      {top}
      <main className="flex flex-1 flex-col py-4">{children}</main>
      {action && <div className="sticky bottom-0 bg-nuoc pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>}
    </div>
  );
}

type Variant = "primary" | "quiet";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-ngoc text-nuoc hover:bg-ngoc/90 disabled:bg-phu-sa/25 disabled:text-phu-sa/60",
    quiet: "bg-transparent text-ngoc underline-offset-4 hover:underline",
  };
  return (
    <button
      type="button"
      className={`min-h-14 w-full rounded-2xl px-6 text-lg font-semibold transition-colors ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

/** Mot vietnamien mis en valeur : c'est l'objet visuel, pas une étiquette. */
export function Vi({ children, size = "vi", className = "" }: { children: ReactNode; size?: "vi" | "vi-xl" | "2xl"; className?: string }) {
  const sizes = { vi: "text-vi", "vi-xl": "text-vi-xl", "2xl": "text-2xl" };
  return (
    <span lang="vi" className={`font-serif ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}
