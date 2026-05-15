import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { IsBoolean, IsOptional } from "class-validator";
import { StyleGuideService } from "../learning/style-guide.service";

class StyleRulePatch {
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

@Controller()
export class StyleRulesController {
  constructor(private readonly styleGuide: StyleGuideService) {}

  @Get("style-rules")
  list() {
    return this.styleGuide.listRules();
  }

  @Patch("style-rules/:id")
  async patch(@Param("id") id: string, @Body() body: StyleRulePatch) {
    await this.styleGuide.setRuleStatus(id, body);
    return { ok: true };
  }

  @Get("style-guide")
  async getGuide() {
    return { content: await this.styleGuide.get() };
  }

  // Trigger a manual re-synthesis. Useful for demos.
  @Post("style-guide/synthesize")
  async synthesize() {
    const content = await this.styleGuide.synthesize();
    return { content };
  }
}
