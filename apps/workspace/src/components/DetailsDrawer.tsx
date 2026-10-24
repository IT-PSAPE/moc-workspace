import type { ReactNode } from "react";
import { Modal } from "@moc/ui";
import "../task-details.css";

type DetailsDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/** Shared floating surface for request and task details across the workspace. */
export default function DetailsDrawer({
  open,
  onClose,
  title,
  children,
}: DetailsDrawerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      side="right"
      drawerWidth={560}
      className="task-detail-modal"
    >
      {children}
    </Modal>
  );
}
