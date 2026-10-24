-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "announcements_organizationId_publishedAt_idx" ON "announcements"("organizationId", "publishedAt");

-- CreateIndex
CREATE INDEX "application_items_applicationId_idx" ON "application_items"("applicationId");

-- CreateIndex
CREATE INDEX "finalized_attempts_studentId_finalizedAt_idx" ON "finalized_attempts"("studentId", "finalizedAt");

-- CreateIndex
CREATE INDEX "finalized_attempts_practiceSetId_idx" ON "finalized_attempts"("practiceSetId");

-- CreateIndex
CREATE INDEX "lesson_progress_lessonId_idx" ON "lesson_progress"("lessonId");

-- CreateIndex
CREATE INDEX "prediction_history_entries_studentId_createdAt_idx" ON "prediction_history_entries"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "question_revisions_questionId_idx" ON "question_revisions"("questionId");

-- CreateIndex
CREATE INDEX "questions_familyId_idx" ON "questions"("familyId");

-- CreateIndex
CREATE INDEX "school_roster_entries_schoolId_idx" ON "school_roster_entries"("schoolId");

-- CreateIndex
CREATE INDEX "student_memberships_schoolId_status_idx" ON "student_memberships"("schoolId", "status");

-- CreateIndex
CREATE INDEX "student_memberships_organizationId_status_idx" ON "student_memberships"("organizationId", "status");
