## Agent-kit设计

增加plugin机制提供新功能的注册机制，loader来增加对于不同场景的资源处理方式，会更像是agent cli的webpack

允许编排与生成工作流（提供基础SOP去生成不同场景的工作流与管理Prompt，内置code场景的[复刻claude code的]）

对于subagent参考DAG的图管理机制