import * as RadixDialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const Dialog = RadixDialog.Root;
export const DialogClose = RadixDialog.Close;
export const DialogTrigger = RadixDialog.Trigger;

export const DialogTitle = forwardRef<
  ElementRef<typeof RadixDialog.Title>,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return <RadixDialog.Title className={clsx("org-dialog-title", className)} ref={ref} {...props} />;
});

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  ComponentPropsWithoutRef<typeof RadixDialog.Content>
>(function DialogContent({ className, ...props }, ref) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="org-overlay" />
      <RadixDialog.Content className={clsx("org-dialog", className)} ref={ref} {...props} />
    </RadixDialog.Portal>
  );
});
