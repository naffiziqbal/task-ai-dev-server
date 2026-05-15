import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post("cases/:caseId/documents")
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @Param("caseId") caseId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(caseId, file);
  }

  @Get("cases/:caseId/documents")
  list(@Param("caseId") caseId: string) {
    return this.documents.listByCase(caseId);
  }

  @Get("documents/:id")
  get(@Param("id") id: string) {
    return this.documents.get(id);
  }

  @Get("documents/:id/pages/:p")
  getPage(
    @Param("id") id: string,
    @Param("p", ParseIntPipe) p: number,
  ) {
    return this.documents.getPage(id, p);
  }
}
