import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import { CasesService } from "./cases.service";

class CreateCaseDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

@Controller("cases")
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  list() {
    return this.cases.list();
  }

  @Post()
  create(@Body() body: CreateCaseDto) {
    return this.cases.create(body.name);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.cases.get(id);
  }
}
