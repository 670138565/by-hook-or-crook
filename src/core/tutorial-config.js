/* =====================================================================
 * 新手教程序列配置（tutorial-config.js）
 * 数据驱动：每步 = 提示文案 + 完成条件。TutSys 按序推进。
 * 文案里 {X} 会被渲染成金色按键胶囊。advance 类型：
 *   - playerMoved  累计移动距离达标
 *   - flag         GameState 字段等于指定值
 *   - notify       收到对应教程事件（TutSys.notify('xxx')）
 *   - delay        停留指定毫秒后自动下一步
 * ===================================================================== */
window.TUTORIAL = {
    steps: [
        {
            id: 't_move',
            text: window.t('tut.t_move.text', '用 {W} {A} {S} {D} 移动'),
            detail: window.t('tut.t_move.detail', '往前走，去捡地上的旧背包'),
            advance: { type: 'playerMoved', distance: 70 }
        },
        {
            id: 't_pickup',
            text: window.t('tut.t_pickup.text', '靠近旧背包，按 {E} 拾取'),
            detail: window.t('tut.t_pickup.detail', '拾取后解锁背包'),
            advance: { type: 'flag', key: 'hasBackpack', value: true }
        },
        {
            id: 't_backpack',
            text: window.t('tut.t_backpack.text', '按 {Tab} 打开背包'),
            detail: window.t('tut.t_backpack.detail', '看看捡到了什么'),
            advance: { type: 'notify', event: 'openedBackpack' }
        },
        {
            id: 't_steal',
            text: window.t('tut.t_steal.text', '走向木箱，靠近后按 {E} 偷窃'),
            detail: window.t('tut.t_steal.detail', '按 {SPACE} 停指针，停进绿色区域'),
            advance: { type: 'notify', event: 'chestOpened' }
        },
        {
            id: 't_search',
            text: window.t('tut.t_search.text', '等物品搜完，拖进背包格子'),
            detail: window.t('tut.t_search.detail', '把箱子里的东西拖到左边背包里'),
            advance: { type: 'notify', event: 'itemToBackpack' }
        },
        {
            id: 't_done',
            text: window.t('tut.t_done.text', '教程完成，去大世界闯荡吧'),
            detail: window.t('tut.t_done.detail', '路上小心守卫'),
            advance: { type: 'delay', ms: 4200 }
        }
    ]
};
