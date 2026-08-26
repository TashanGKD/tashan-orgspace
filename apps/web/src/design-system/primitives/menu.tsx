import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export const MenuContent = forwardRef<
  ElementRef<typeof DropdownMenu.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(function MenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={clsx("org-menu-content", className)}
        ref={ref}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenu.Portal>
  );
});

export const MenuItem = forwardRef<
  ElementRef<typeof DropdownMenu.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Item>
>(function MenuItem({ className, ...props }, ref) {
  return <DropdownMenu.Item className={clsx("org-menu-item", className)} ref={ref} {...props} />;
});
