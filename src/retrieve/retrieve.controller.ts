import { Body, Controller, Param, Post } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { RetrieveService } from "./retrieve.service";

class RetrieveDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  k?: number;
}

@Controller("cases/:caseId/retrieve")
export class RetrieveController {
  constructor(private readonly retrieve: RetrieveService) {}

  @Post()
  run(@Param("caseId") caseId: string, @Body() body: RetrieveDto) {
    return this.retrieve.retrieve({ caseId, query: body.query, k: body.k });
  }
}
