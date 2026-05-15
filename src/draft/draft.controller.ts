import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { IsArray, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { DraftService } from "./draft.service";
import { LearningService } from "../learning/learning.service";

class SectionEditDto {
  @IsString()
  key!: string;

  @IsString()
  text!: string;
}

class DraftEditDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionEditDto)
  sections!: SectionEditDto[];
}

@Controller()
export class DraftController {
  constructor(
    private readonly drafts: DraftService,
    private readonly learning: LearningService,
  ) {}

  @Post("cases/:caseId/drafts")
  generate(@Param("caseId") caseId: string) {
    return this.drafts.generate(caseId);
  }

  @Get("cases/:caseId/drafts")
  listByCase(@Param("caseId") caseId: string) {
    return this.drafts.listByCase(caseId);
  }

  @Get("drafts/:id")
  get(@Param("id") id: string) {
    return this.drafts.get(id);
  }

  // Operator save. Triggers the entire learning loop:
  // diff → classify → style rules + few-shot pairs + retrieval-miss logging.
  @Patch("drafts/:id")
  async edit(@Param("id") id: string, @Body() body: DraftEditDto) {
    return this.learning.handleEdit(id, body.sections);
  }
}
