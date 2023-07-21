import {
  AgentActionOutputParser,
  AgentExecutor,
  LLMSingleActionAgent,
} from 'langchain/agents';
import { LLMChain } from 'langchain/chains';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import {
  BaseStringPromptTemplate,
  BasePromptTemplate,
  SerializedBasePromptTemplate,
  renderTemplate,
} from 'langchain/prompts';
import {
  AgentAction,
  AgentFinish,
  AgentStep,
  InputValues,
  PartialValues,
} from 'langchain/schema';
import { DataSource } from 'typeorm';
import { SqlDatabase } from 'langchain/sql_db';
import { DynamicTool, Tool } from 'langchain/tools';
import {
  InfoSqlTool,
  QuerySqlTool,
  ListTablesSqlTool,
  QueryCheckerTool,
} from 'langchain/tools/sql';

const PREFIX = `You are an expert in MySQL databases,Answer the following questions as best you can. You have access to the following tools:`;
const formatInstructions = (
  toolNames: string,
) => `Use the following format in your response:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question`;
const SUFFIX = `Begin!

Question: {input}的最佳查询语句是什么?
Thought:{agent_scratchpad}`;

class CustomPromptTemplate extends BaseStringPromptTemplate {
  tools: Tool[];

  constructor(args: { tools: Tool[]; inputVariables: string[] }) {
    super({ inputVariables: args.inputVariables });
    this.tools = args.tools;
  }

  _getPromptType(): string {
    return 'promptType';
  }

  async format(input: InputValues): Promise<string> {
    /** Construct the final template */
    const toolStrings = this.tools
      .map((tool) => `${tool.name}: ${tool.description}`)
      .join('\n');
    const toolNames = this.tools.map((tool) => tool.name).join('\n');
    const instructions = formatInstructions(toolNames);
    const template = [PREFIX, toolStrings, instructions, SUFFIX].join('\n\n');
    /** Construct the agent_scratchpad */
    const intermediateSteps = input.intermediate_steps as AgentStep[];
    const agentScratchpad = intermediateSteps.reduce(
      (thoughts, { action, observation }) =>
        thoughts +
        [action.log, `\nObservation: ${observation}`, 'Thought:'].join('\n'),
      '',
    );
    const newInput = { agent_scratchpad: agentScratchpad, ...input };
    /** Format the template. */
    return Promise.resolve(renderTemplate(template, 'f-string', newInput));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  partial(_values: PartialValues): Promise<BasePromptTemplate> {
    throw new Error('Not implemented');
  }

  serialize(): SerializedBasePromptTemplate {
    throw new Error('Not implemented');
  }
}

class CustomOutputParser extends AgentActionOutputParser {
  lc_namespace = ['langchain', 'agents', 'custom_llm_agent_chat'];

  async parse(text: string): Promise<AgentAction | AgentFinish> {
    if (text.includes('Final Answer:')) {
      console.log('=======text======', text);
      const parts = text.split('Final Answer:');
      const input = parts[parts.length - 1].trim();
      const finalAnswers = { output: input };
      return { log: text, returnValues: finalAnswers };
    }
    console.log('-----------text------------', text);
    const match = /Action: (.*)\nAction Input: (.*)/s.exec(text);
    if (!match) {
      throw new Error(`Could not parse LLM output: ${text}`);
    }
    console.log('*********parser**********', {
      tool: match[1].trim(),
      toolInput: match[2].trim().replace(/^"+|"+$/g, ''),
      log: text,
    });
    return {
      tool: match[1].trim(),
      toolInput: match[2].trim().replace(/^"+|"+$/g, ''),
      log: text,
    };
  }

  getFormatInstructions(): string {
    throw new Error('Not implemented');
  }
}

export const runSqlAgent = async (input = '2023年已完成订单的数量') => {
  const model = new ChatOpenAI({
    temperature: 0,
    verbose: true,
    modelName: 'gpt-3.5-turbo',
    topP: 0,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  });
  const beesDataSource = new DataSource({
    type: 'mysql',
    host: '47.102.220.122',
    port: 3306,
    username: 'lz',
    password: process.env.MYSQL_PWD,
    database: 'order-test',
    // entities: ['bees_order'],
  });

  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: beesDataSource,
    sampleRowsInTableInfo: 0,
    // includesTables: ['bees_order'],
  });
  const tools: Tool[] = [
    new QuerySqlTool(db),
    new InfoSqlTool(db),
    new ListTablesSqlTool(db),
    new QueryCheckerTool(),
    new DynamicTool({
      name: 'getTableName',
      description: '获取描述中对应的表名，例如订单：bees_order',
      func: async (desc) => {
        switch (desc) {
          case '订单':
            return 'bees_order';
        }
      },
    }),

    new DynamicTool({
      name: 'getOrderStatusDictValue',
      description: `获取描述内容的columnName和字典值(cloumnName:dictValue)，例如已完成订单，返回: status:3,待付款订单返回: status:0`,
      func: async (desc) => {
        switch (desc) {
          // 订单状态【0-待付款;1-待发货;2-已发货;3-已完成;4-已取消;5-审核中(废弃);6-已退款;7-售后退货退款;8-已失效;9-部分发货;10-部分支付;11-待提货;12-部分提货;20-待审核;21-未支付待审核;22-已支付待审核;23-待确认;30-已送达待签收】
          case '待付款订单':
            return 'status:0';
          case '待发货订单':
            return 'status:1';
          case '已发货订单':
            return 'status:2';
          case '已完成订单':
            return 'status:3';
          case '已取消订单':
            return 'status:4';
        }
      },
    }),

    // new DynamicTool({
    //   name: 'getColumnDictValue',
    //   description:
    //     '获取描述中字段对应的字典值，例如已完成的订单，对应的status:3',
    //   func: async (desc) => {
    //     switch (desc) {
    //       case '已完成订单':
    //         return '3';
    //     }
    //   },
    // }),
    new DynamicTool({
      name: 'getColumnName',
      description: '获取描述中字段对应的列名，例如订单发生日期：create_time',
      func: async (desc) => {
        switch (desc) {
          case '订单金额':
            return 'total_amount';
          case '订单发生日期':
            return 'create_time';
          case '订单状态':
            return 'status';
        }
      },
    }),

    new DynamicTool({
      name: 'formatQuerySqlInput',
      description: '在执行query-sql tool,格式化Input,把\n替换为空格,把`换成"',
      func: async (sql) => {
        let ret = '';
        if (sql.indexOf('\n') > -1) {
          const regex = /\n/g;
          ret = sql.replace(regex, ' ');
        }
        if (ret.indexOf('```') > -1) {
          const regex = /```/g;
          ret = sql.replace(regex, '`');
        }
        return sql;
      },
    }),

    // new DynamicTool({
    //   name: 'formatQuerySqlResult',
    //   description: '格式化query-sql的结果,如果结果是table,则以json的形式返回',
    //   func: async (result) => {
    //     // return `Action: formatQuerySqlResult, Action Input: ${JSON.stringify(
    //     //   result,
    //     // )}`;
    //     return `Final Answer: ${JSON.stringify(result)}`;
    //   },
    // }),
  ];

  const llmChain = new LLMChain({
    prompt: new CustomPromptTemplate({
      tools,
      inputVariables: ['input', 'agent_scratchpad'],
    }),
    llm: model,
  });

  const agent = new LLMSingleActionAgent({
    llmChain,
    outputParser: new CustomOutputParser(),
    stop: ['\nObservation'],
  });
  const executor = new AgentExecutor({
    agent,
    tools,
  });
  console.log('Loaded agent.');

  console.log(`Executing with input "${input}"...`);

  const result = await executor.call({ input });

  console.log(`Got output ${result.output}`);

  return result.output;
};
