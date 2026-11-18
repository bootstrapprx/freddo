import { useAuth } from "@/lib/AuthContext";
import { ModalFrame, ghostButton, primaryButton } from "./ModalFrame";

export function QuitOverlay({ onClose }) {
  const { logout } = useAuth();

  return (
    <ModalFrame
      title="detach"
      hint="sessão do control plane"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className={ghostButton} onClick={() => logout()}>
            encerrar sessão
          </button>
          <button type="button" className={primaryButton} onClick={onClose}>
            reattach
          </button>
        </>
      }
    >
      <div className="space-y-2 text-[11px] leading-relaxed text-sub1">
        <p className="text-sub0">
          <span className="text-mauve">$</span> fmx-control detach
        </p>
        <p className="text-overlay1">
          o daemon continua rodando em background · telemetria e alocações de custo seguem sendo
          gravadas no SQLite.
        </p>
        <p className="border border-surface0/60 bg-mantle/40 px-3 py-2 text-[10px] text-overlay1">
          para reconectar no terminal real:
          <br />
          <span className="text-teal">fmx attach control-plane --tui</span>
        </p>
      </div>
    </ModalFrame>
  );
}