import { Module } from "@nestjs/common";
import { LearningService } from "./learning.service";
import { EditClassifier } from "./edit-classifier";
import { StyleGuideService } from "./style-guide.service";
import { FewShotService } from "./few-shot.service";
import { RetrievalFeedbackService } from "./retrieval-feedback.service";

@Module({
  providers: [
    LearningService,
    EditClassifier,
    StyleGuideService,
    FewShotService,
    RetrievalFeedbackService,
  ],
  exports: [LearningService, StyleGuideService, FewShotService],
})
export class LearningModule {}
