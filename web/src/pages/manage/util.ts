import type { View } from "../../api.ts";

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const dayNum = (s: string) => Math.round(new Date(s + "T00:00:00Z").getTime() / 86400_000);
export const nt = (n: number) => n.toLocaleString("zh-TW");

/** 節點是否已核可：沒有次系統分場的看最後一筆簽核；分場審查的節點要每個次系統最後一筆都是核可。 */
export function gateApproved(view: View, gateId: string, subsystems: string[]): boolean {
  const records = view.project.signoffs.filter((s) => s.gate === gateId);
  const def = view.gates.find((g) => g.id === gateId);
  if (def?.perSubsystem) return subsystems.length > 0 && subsystems.every((n) => records.filter((s) => s.subsystem === n).at(-1)?.decision === "APPROVE");
  return records.filter((s) => !s.subsystem).at(-1)?.decision === "APPROVE";
}
