/**
 * 飞书多维表格 SDK 的测试替身。
 *
 * 真机环境里 `bitable` 由飞书注入到 iframe 里；测试环境没有宿主，
 * 因此在 esbuild 打包时用 --alias 把这个包换成此文件，即可让
 * ImportPanel / ExportPanel / App 在 Node 里真实渲染。
 */
export const bitable = {
  base: {
    getTableMetaList: async () => [],
    getTableById: async () => ({ id: 'tbl_stub', name: 'stub' }),
    addTable: async () => ({ id: 'tbl_stub' }),
  },
  bridge: {
    getBaseUserId: async () => 'stub-user',
  },
}

export default { bitable }
