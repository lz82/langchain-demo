import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SqlDatabase } from 'langchain/sql_db';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { initializeAgentExecutorWithOptions } from 'langchain/agents';
import {
  InfoSqlTool,
  QuerySqlTool,
  ListTablesSqlTool,
  QueryCheckerTool,
} from 'langchain/tools/sql';
import { DynamicTool, Tool } from 'langchain/tools';
import { runSqlAgent } from '../model/sql-agent';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  async getQuerySql(input = '2023年有多少笔已完成的订单?'): Promise<string> {
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

    // const sqlChain = new SqlDatabaseChain({
    //   llm: new OpenAI({ temperature: 0 }),
    //   database: db,
    //   sqlOutputKey: 'sql',
    // });

    const model = new ChatOpenAI({
      temperature: 0,
      verbose: true,
      modelName: 'gpt-3.5-turbo',
      topP: 0,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    });

    // model.predictMessages([new HumanChatMessage(input)], {

    // })

    /*
    model.predictMessages([new HumanChatMessage('订单数据应该找哪张表?')], {
      functions: [
        {
          name: 'get_correct_table',
          description: 'find correct table name',
          parameters: {
            type: 'object',
            properties: {
              tableName: {
                type: 'string',
                description: 'table name',
              },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      ],
    });
    */

    // const toolkit = new QuerySqlTool(db);
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

      new DynamicTool({
        name: 'formatQuerySqlResult',
        description: '格式化query-sql的结果,如果结果是table,则以json的形式返回',
        func: async (result) => {
          // return `Action: formatQuerySqlResult, Action Input: ${JSON.stringify(
          //   result,
          // )}`;
          return `Final Answer: ${JSON.stringify(result)}`;
        },
      }),
    ];
    const executor = await initializeAgentExecutorWithOptions(tools, model, {
      agentType: 'zero-shot-react-description',
      maxIterations: 999999,
    });
    // const sqlExecutor = createSqlAgent(model, new SqlToolkit(db), {});

    const result = await executor.call({
      input: `${input}`,
    });
    console.log(result);
    return 'Hello Sql!';
  }

  async getCustomQuerySql(input): Promise<any> {
    return await runSqlAgent(input);
  }
}
