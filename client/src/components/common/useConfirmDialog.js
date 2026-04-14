import { useCallback, useState } from 'react';

export default function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState(null);

  const requestConfirm = useCallback((options) => {
    setConfirmDialog(options);
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  const acceptConfirm = useCallback(() => {
    const onConfirm = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    onConfirm?.();
  }, [confirmDialog]);

  return {
    confirmDialog,
    requestConfirm,
    cancelConfirm,
    acceptConfirm,
  };
}
