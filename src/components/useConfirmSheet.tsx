import { useCallback, useState, type ReactElement } from 'react';

import { LocraSheet } from './LocraSheet';

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
}

interface ConfirmSheet {
  /** Opens the Locra confirmation sheet; replaces imperative `Alert.alert`. */
  readonly confirm: (options: ConfirmOptions) => void;
  /** Render this once in the component tree. */
  readonly dialog: ReactElement;
}

/**
 * Imperative confirmation on top of the shared {@link LocraSheet}, so screens can
 * keep a simple `confirm({...})` call where they used a native alert while the UI
 * stays on Locra's tokenized surface.
 */
export function useConfirmSheet(): ConfirmSheet {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const close = useCallback(() => setOptions(null), []);
  const confirm = useCallback((next: ConfirmOptions) => setOptions(next), []);

  const dialog = (
    <LocraSheet
      visible={options !== null}
      title={options?.title}
      message={options?.message}
      onRequestClose={close}
      actions={
        options === null
          ? []
          : [
              {
                label: options.confirmLabel ?? 'Confirm',
                variant: options.destructive === true ? 'destructive' : 'primary',
                onPress: () => {
                  const onConfirm = options.onConfirm;
                  close();
                  onConfirm();
                },
              },
              {
                label: options.cancelLabel ?? 'Cancel',
                variant: 'quiet',
                onPress: close,
              },
            ]
      }
    />
  );

  return { confirm, dialog };
}
