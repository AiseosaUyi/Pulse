"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageCircle, Trash2 } from "lucide-react";
import { FeatureSetupNotice } from "@/components/ui/FeatureSetupNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogs } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";
import {
  saveWhatsappAccount,
  disconnectWhatsappAccount,
} from "@/lib/actions/whatsapp";
import type { WhatsappConnectionStatus } from "@/lib/services/broadcasts";

export function WhatsAppConnectCard({
  status,
}: {
  status: WhatsappConnectionStatus;
}) {
  const dialogs = useDialogs();
  const [connected, setConnected] = useState(status.connected);
  const [displayPhone, setDisplayPhone] = useState(status.displayPhone);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [displayPhoneInput, setDisplayPhoneInput] = useState("");
  const [pending, startTransition] = useTransition();

  if (connected) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 size={15} className="text-status-green flex-shrink-0" />
          <p className="text-sm text-foreground">
            WhatsApp connected
            {displayPhone ? (
              <span className="text-text-muted"> — {displayPhone}</span>
            ) : null}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="gap-1.5 text-status-red hover:text-status-red flex-shrink-0"
          onClick={() => {
            startTransition(async () => {
              const ok = await dialogs.confirm({
                title: "Disconnect WhatsApp?",
                subtitle:
                  "Broadcasts will stop sending until you reconnect a number.",
                tone: "destructive",
                confirmLabel: "Disconnect",
              });
              if (!ok) return;
              const res = await disconnectWhatsappAccount();
              if (!res.success) {
                toast.error(res.error);
                return;
              }
              setConnected(false);
              toast.success("WhatsApp disconnected");
            });
          }}
        >
          <Trash2 size={14} />
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FeatureSetupNotice
        icon={MessageCircle}
        title="WhatsApp isn't connected yet"
        description={
          status.lastError
            ? `Broadcasts won't send until a number is connected. Last error: ${status.lastError}`
            : "Broadcasts won't send until you connect a WhatsApp Cloud API number."
        }
        steps={[
          "Go to Meta for Developers → your WhatsApp Business app → API Setup",
          "Copy the Phone number ID and generate a permanent access token (System User token, recommended over the 24h test token)",
          "Paste both below to connect this workspace's number",
        ]}
      />
      <form
        className="rounded-2xl border border-border bg-card p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!phoneNumberId.trim() || !accessToken.trim()) {
            toast.error("Phone number ID and access token are required");
            return;
          }
          startTransition(async () => {
            const res = await saveWhatsappAccount({
              phoneNumberId: phoneNumberId.trim(),
              accessToken: accessToken.trim(),
              displayPhone: displayPhoneInput.trim() || undefined,
            });
            if (!res.success) {
              toast.error(res.error);
              return;
            }
            setConnected(true);
            setDisplayPhone(displayPhoneInput.trim() || null);
            toast.success("WhatsApp connected");
          });
        }}
      >
        <div>
          <Label htmlFor="wa-phone-id">Phone number ID</Label>
          <Input
            id="wa-phone-id"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="e.g. 109876543210987"
          />
        </div>
        <div>
          <Label htmlFor="wa-token">Access token</Label>
          <Input
            id="wa-token"
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="EAAG..."
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="wa-display">Display number (optional)</Label>
          <Input
            id="wa-display"
            value={displayPhoneInput}
            onChange={(e) => setDisplayPhoneInput(e.target.value)}
            placeholder="+234 803 000 0000"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </div>
  );
}
