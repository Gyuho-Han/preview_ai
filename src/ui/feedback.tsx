// 공용 피드백 UI — 토스트 알림 + 확인 모달.
// 네이티브 alert()/confirm() 대체. 어디서든 toast()/confirmDialog() 호출.
// App에 <FeedbackHost/> 한 번만 마운트하면 동작한다.
import { useEffect, useState } from "react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; msg: string; type: ToastType };

let toastSeq = 0;
const toastListeners = new Set<(t: ToastItem) => void>();

export function toast(msg: string, type: ToastType = "success") {
  const item: ToastItem = { id: ++toastSeq, msg, type };
  toastListeners.forEach((l) => l(item));
}

type ConfirmReq = {
  id: number;
  msg: string;
  title?: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
};

let confirmSeq = 0;
const confirmListeners = new Set<(r: ConfirmReq) => void>();

export function confirmDialog(opts: {
  msg: string;
  title?: string;
  confirmText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const req: ConfirmReq = { id: ++confirmSeq, resolve, ...opts };
    confirmListeners.forEach((l) => l(req));
  });
}

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [req, setReq] = useState<ConfirmReq | null>(null);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setToasts((list) => [...list, t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3400);
    };
    const onConfirm = (r: ConfirmReq) => setReq(r);
    toastListeners.add(onToast);
    confirmListeners.add(onConfirm);
    return () => {
      toastListeners.delete(onToast);
      confirmListeners.delete(onConfirm);
    };
  }, []);

  function close(v: boolean) {
    req?.resolve(v);
    setReq(null);
  }

  return (
    <>
      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === "success" ? "✓" : t.type === "error" ? "!" : "i"}
            </span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {req && (
        <div className="modal-overlay" onClick={() => close(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {req.title && <h3 className="modal-title">{req.title}</h3>}
            <p className="modal-msg">{req.msg}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => close(false)}>
                취소
              </button>
              <button className={req.danger ? "danger" : ""} onClick={() => close(true)}>
                {req.confirmText || "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
