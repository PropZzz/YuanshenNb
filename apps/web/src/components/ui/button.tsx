import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "@/components/ui/reference-icons";
import { cn } from "@/lib/utils";
const buttonVariants = cva("button", { variants: { variant: { default: "button-primary", secondary: "button-secondary", ghost: "button-ghost", danger: "button-danger", outline: "button-outline" }, size: { default: "", sm: "button-sm", icon: "button-icon" } }, defaultVariants: { variant: "default", size: "default" } });
type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { pending?: boolean };
export const Button = forwardRef<HTMLButtonElement, Props>(({ className, variant, size, pending, disabled, children, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>{pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{children}</button>
));
Button.displayName = "Button";

