import { Controller, Get, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { Request } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('query-sql')
  async getQuerySql(@Req() request: Request): Promise<string> {
    console.log('request:', request.query.input);
    const input = request.query.input as string;
    const res = await this.appService.getQuerySql(input);
    return res;
  }

  @Get('custom-query-sql')
  async getCustomQuerySql(@Req() request: Request): Promise<string> {
    console.log('request:', request.query.input);
    const input = request.query.input as string;
    const res = await this.appService.getCustomQuerySql(input);
    return res;
  }
}
