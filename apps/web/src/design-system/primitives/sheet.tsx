import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export const SheetTitle = forwardRef<
  ElementRef<typeof Dialog.Title>,
  ComponentPropsWithoutRef<typeof Dialog.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return <Dialog.Title className={clsx("org-sheet-title", className)} ref={ref} {...props} />;
});

export const SheetContent = forwardRef<
  ElementRef<typeof Dialog.Content>,
  ComponentPropsWithoutRef<typeof Dialog.Content>
>(function SheetContent({ children, className, ...props }, ref) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="org-overlay" />
      <Dialog.Content className={clsx("org-sheet", className)} ref={ref} {...props}>
        {children}
        <Dialog.Close className="org-sheet-close" aria-label="关闭">
          <X aria-hidden size={17} />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
});
