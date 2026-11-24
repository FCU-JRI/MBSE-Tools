// 框架定義檔（framework/jri.json）由 Vite 直接打包；這裡只宣告型別，tsconfig 不必開 resolveJsonModule。
declare module "*/framework/jri.json" {
  const value: unknown;
  export default value;
}
