import { useState } from 'react';
import { Button, Stack, Text } from '@/design';
import { authStore, submitPin } from '../api/client';
import { TextInput } from '../kit/controls';
import { useStore } from '../state/store';
import s from './Shell.module.css';

/** Wi-Fi access asks for the PIN the phone shows under Connect a laptop. */
export function PinScreen() {
  const busy = useStore(authStore, (x) => x.busy);
  const error = useStore(authStore, (x) => x.error);
  const [pin, setPin] = useState('');
  const submit = async () => {
    if (pin.length < 4) return;
    if (!(await submitPin(pin))) setPin('');
  };
  return (
    <div className={s.pinScreen} role="dialog" aria-modal="true" aria-label="Enter the PIN">
      <form
        className={s.pinCard}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack gap={16}>
          <Stack direction="row" gap={12} align="center">
            <div className={s.brandMark}>KC</div>
            <div className={s.brandName}>
              SWAG PAY
              <br />
              KILLCAM
            </div>
          </Stack>
          <Text as="h1" variant="heading-lg">
            Enter the PIN
          </Text>
          <Text as="p" variant="body">
            You are connecting over Wi-Fi. The PIN is on the phone, in Killcam’s menu under Connect a laptop. Over USB no PIN is needed.
          </Text>
          <TextInput
            className={s.pinInput}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="PIN"
            placeholder="••••••"
            invalid={!!error}
          />
          {error && (
            <Text variant="small" tone="fail">
              ✕ {error}
            </Text>
          )}
          <Button type="submit" variant="primary" large disabled={busy || pin.length < 4}>
            {busy ? 'Checking…' : 'Unlock'}
          </Button>
        </Stack>
      </form>
    </div>
  );
}
