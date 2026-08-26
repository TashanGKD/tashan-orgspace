import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";

const buttonVariants = cva("org-button", {
  variants: {
    variant: {
      primary: "org-button--primary",
      secondary: "org-button--secondary",
      quiet: "org-button--quiet",
      danger: "org-button--danger",
    },
    size: {
      small: "org-button--small",
      medium: "",
      large: "org-button--large",
    },
  },
  defaultVariants: { variant: "primary", size: "medium" },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild = false, className, size, type = "button", variant, ...props },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={clsx(buttonVariants({ size, variant }), className)}
      ref={ref}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
});
