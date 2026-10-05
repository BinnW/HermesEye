// These are capability boundaries, not invented Hermes HTTP endpoints.
export interface IntegrationCapability { id: string; title: string; status: string; requirement: string; }
export function integrationCapabilities(): IntegrationCapability[] {
  return [
    { id: 'sync', title: '业务同步与会话恢复', status: '待协议联调', requirement: '服务器标识、增量游标、会话持久化、冲突及删除协议' },
    { id: 'runs', title: 'Coding Agent / 多 Agent / 部署', status: '待协议联调', requirement: '运行标识、事件续传、授权、幂等与部署回执' },
    { id: 'reading', title: '微信读书与 IMA', status: '尚未获取', requirement: '服务端 Skill、计数口径、摘抄引用、总结写入与定时工作流' },
    { id: 'health', title: '华为运动健康', status: '尚未接入', requirement: '开放资格、受支持数据项与独立授权' },
    { id: 'vaults', title: '双 PARA Vault', status: '待连接', requirement: '手工/Agent 托管空间、读取/写入授权及成果确认' },
    { id: 'schedule', title: '周期强提醒与精力日报', status: '待策略确认', requirement: '工作时段、量表、固定模板与免打扰规则；熄屏设备验证' }
  ];
}
