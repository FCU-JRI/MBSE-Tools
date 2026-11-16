// SysML v2 的每一種定義與使用各一個最小的合成例子（規範 8.2.2 節），用來確認工具都列得出來。
// 每一列：[說明, 原始碼, 要找的名稱, 元類別, 關鍵字]。原始碼會包在 package K 裡，前面有 PRELUDE。
// supported 為 false 的列是解析器目前的缺口：照實記錄，解析器更新後測試會提醒把它改回 true。
export const PRELUDE = `
    private import ScalarValues::*;
    part def P { port pp : PD; out item oi : I; in item ii : I; }
    port def PD;
    item def I;
    action def AD;
    state def SD;
    requirement def RD;
`;
export interface KindRow { label: string; source: string; name: string; kind: string; keyword: string; supported?: false; top?: true }
const row = (label: string, source: string, name: string, kind: string, keyword: string, extra: Partial<KindRow> = {}): KindRow => ({ label, source, name, kind, keyword, ...extra });
export const KINDS: KindRow[] = [
  row("套件", "package Inner { }", "Inner", "Package", "package"),
  row("庫套件", "library package Lib { part def X; }", "Lib", "LibraryPackage", "library package", { top: true }),
  row("註解", "comment note /* 合成的註解。 */", "note", "Comment", "comment"),
  row("屬性定義", "attribute def A1;", "A1", "AttributeDefinition", "attribute def"),
  row("屬性", "attribute a1 : Real;", "a1", "AttributeUsage", "attribute"),
  row("列舉定義", "enum def E1 { enum low; enum high; }", "E1", "EnumerationDefinition", "enum def"),
  row("列舉值", "enum def E1 { enum low; enum high; }", "low", "EnumerationUsage", "enum"),
  row("事件定義", "occurrence def O1;", "O1", "OccurrenceDefinition", "occurrence def"),
  row("事件", "occurrence o1;", "o1", "OccurrenceUsage", "occurrence"),
  row("個體定義", "individual part def P1 :> P;", "P1", "PartDefinition", "individual part def"),
  row("個體", "individual part def P1 :> P; individual part p1 : P1;", "p1", "PartUsage", "individual part"),
  row("快照", "individual part def P1 :> P; individual part p1 : P1 { snapshot s1; }", "s1", "OccurrenceUsage", "snapshot"),
  row("時間切片", "individual part def P1 :> P; individual part p1 : P1 { timeslice t1; }", "t1", "OccurrenceUsage", "timeslice"),
  row("項目定義", "item def I1;", "I1", "ItemDefinition", "item def"),
  row("項目", "item i1 : I;", "i1", "ItemUsage", "item"),
  row("零件定義", "part def P1;", "P1", "PartDefinition", "part def"),
  row("抽象的零件定義", "abstract part def P1;", "P1", "PartDefinition", "abstract part def"),
  row("零件", "part p1 : P;", "p1", "PartUsage", "part"),
  row("參照的零件", "part def P1 { ref part r1 : P; }", "r1", "PartUsage", "ref part"),
  row("連接埠定義", "port def PD1;", "PD1", "PortDefinition", "port def"),
  row("連接埠", "part def P1 { port p1 : PD; }", "p1", "PortUsage", "port"),
  row("連結定義", "connection def C1 { end part a : P; end part b : P; }", "C1", "ConnectionDefinition", "connection def"),
  row("連結的端點", "connection def C1 { end part a : P; end part b : P; }", "a", "PartUsage", "end part"),
  row("連結", "part h { part l : P; part r : P; connection c1 connect l to r; }", "c1", "ConnectionUsage", "connection"),
  row("介面定義", "interface def IF1 { end port a : PD; end port b : ~PD; }", "IF1", "InterfaceDefinition", "interface def"),
  row("介面", "part h { part l : P; part r : P; interface if1 connect l.pp to r.pp; }", "if1", "InterfaceUsage", "interface"),
  row("分配定義", "allocation def AL1;", "AL1", "AllocationDefinition", "allocation def"),
  row("分配", "part l : P; part r : P; allocation al1 allocate l to r;", "al1", "AllocationUsage", "allocation"),
  row("流定義", "flow def F1 { end part a : P; end part b : P; }", "F1", "FlowDefinition", "flow def"),
  row("流定義（抽象）", "abstract flow def F1;", "F1", "FlowDefinition", "abstract flow def"),
  // 解析器回報「Must have at least two related elements」。這是規範的限制還是解析器的缺口，還沒有查證
  row("流定義（沒有寫端點）", "flow def F1;", "F1", "FlowDefinition", "flow def", { supported: false }),
  row("流", "part h { part l : P; part r : P; flow f1 of I from l.oi to r.ii; }", "f1", "FlowUsage", "flow"),
  row("動作定義", "action def AD1;", "AD1", "ActionDefinition", "action def"),
  row("動作", "action a1 : AD;", "a1", "ActionUsage", "action"),
  row("執行動作", "part p1 : P { perform action pa1 : AD; }", "pa1", "PerformActionUsage", "perform action"),
  row("狀態定義", "state def SD1;", "SD1", "StateDefinition", "state def"),
  row("狀態", "state s1 : SD;", "s1", "StateUsage", "state"),
  row("展現狀態", "part p1 : P { exhibit state es1 : SD; }", "es1", "ExhibitStateUsage", "exhibit state"),
  row("計算定義", "calc def CD1 { in x : Real; return : Real = x * 2; }", "CD1", "CalculationDefinition", "calc def"),
  row("計算", "calc def CD1 { in x : Real; return : Real = x * 2; } calc c1 : CD1;", "c1", "CalculationUsage", "calc"),
  row("限制定義", "constraint def CN1 { in x : Real; x > 0 }", "CN1", "ConstraintDefinition", "constraint def"),
  row("限制", "constraint cn1 { 1 > 0 }", "cn1", "ConstraintUsage", "constraint"),
  row("需求定義", "requirement def RD1 { doc /* 合成的需求。 */ }", "RD1", "RequirementDefinition", "requirement def"),
  row("需求", "requirement r1 : RD;", "r1", "RequirementUsage", "requirement"),
  row("關注事項定義", "concern def CC1;", "CC1", "ConcernDefinition", "concern def"),
  row("關注事項", "concern cc1;", "cc1", "ConcernUsage", "concern"),
  row("案例定義", "case def CS1;", "CS1", "CaseDefinition", "case def"),
  row("案例", "case cs1;", "cs1", "CaseUsage", "case"),
  row("分析定義", "analysis def AN1;", "AN1", "AnalysisCaseDefinition", "analysis def"),
  row("分析", "analysis an1;", "an1", "AnalysisCaseUsage", "analysis"),
  row("驗證定義", "verification def V1;", "V1", "VerificationCaseDefinition", "verification def"),
  row("驗證", "verification v1;", "v1", "VerificationCaseUsage", "verification"),
  row("使用案例定義", "use case def U1;", "U1", "UseCaseDefinition", "use case def"),
  row("使用案例", "use case u1;", "u1", "UseCaseUsage", "use case"),
  row("視圖定義", "view def VW1;", "VW1", "ViewDefinition", "view def"),
  row("視圖", "view vw1;", "vw1", "ViewUsage", "view"),
  row("視點定義", "viewpoint def VP1;", "VP1", "ViewpointDefinition", "viewpoint def"),
  row("視點", "viewpoint vp1;", "vp1", "ViewpointUsage", "viewpoint"),
  row("呈現定義", "rendering def RN1;", "RN1", "RenderingDefinition", "rendering def"),
  row("呈現", "rendering rn1;", "rn1", "RenderingUsage", "rendering"),
  row("標記定義", "metadata def M1;", "M1", "MetadataDefinition", "metadata def"),
];
