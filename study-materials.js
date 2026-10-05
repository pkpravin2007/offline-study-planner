const EDUCATION_LEVELS = ["school", "college"];
const MATERIAL_TYPES = ["notes", "summary", "text"];

function cleanFlashcard(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Flashcard data must be an object." };
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const chapter = typeof body.chapter === "string" ? body.chapter.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!subject || subject.length > 60) return { error: "Choose a subject of 1 to 60 characters." };
  if (!chapter || chapter.length > 120) return { error: "Enter a chapter of 1 to 120 characters." };
  if (!question || question.length > 500) return { error: "Flashcard questions must be between 1 and 500 characters." };
  if (!answer || answer.length > 2000) return { error: "Flashcard answers must be between 1 and 2,000 characters." };
  return { flashcard: { subject, chapter, question, answer } };
}

function cleanEducation(body) {
  const educationLevel = body.educationLevel;
  if (!EDUCATION_LEVELS.includes(educationLevel)) {
    return { error: "Choose school or college as the education level." };
  }
  const education = {
    educationLevel,
    classLevel: null,
    course: "",
    semester: null
  };
  if (educationLevel === "school") {
    const classLevel = Number(body.classLevel);
    if (!Number.isInteger(classLevel) || classLevel < 6 || classLevel > 12) {
      return { error: "Choose a school class from 6 to 12." };
    }
    education.classLevel = classLevel;
  } else {
    const course = typeof body.course === "string" ? body.course.trim() : "";
    const semester = body.semester === "" || body.semester === null || body.semester === undefined
      ? null
      : Number(body.semester);
    if (!course || course.length > 80) return { error: "Enter a course name of 1 to 80 characters." };
    if (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 16)) {
      return { error: "Choose a semester from 1 to 16, or leave it blank." };
    }
    education.course = course;
    education.semester = semester;
  }
  return { education };
}

function cleanMaterial(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Material data must be an object." };
  const educationResult = cleanEducation(body);
  if (educationResult.error) return educationResult;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const chapter = typeof body.chapter === "string" ? body.chapter.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title || title.length > 120) return { error: "Material titles must be between 1 and 120 characters." };
  if (!subject || subject.length > 60) return { error: "Choose a subject of 1 to 60 characters." };
  if (chapter.length > 120) return { error: "Chapter names must be 120 characters or fewer." };
  if (!MATERIAL_TYPES.includes(body.type)) return { error: "Choose Notes, Summary, or Text material." };
  if (!content || content.length > 20000) return { error: "Study material must contain 1 to 20,000 characters." };
  return {
    material: {
      ...educationResult.education,
      title,
      subject,
      chapter,
      type: body.type,
      content,
      sourceLabel: "Student-created"
    }
  };
}

function cleanChecklistItem(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Checklist data must be an object." };
  const educationResult = cleanEducation(body);
  if (educationResult.error) return educationResult;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const chapter = typeof body.chapter === "string" ? body.chapter.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!subject || subject.length > 60) return { error: "Choose a subject of 1 to 60 characters." };
  if (!chapter || chapter.length > 120) return { error: "Enter a chapter of 1 to 120 characters." };
  if (!title || title.length > 160) return { error: "Checklist items must be between 1 and 160 characters." };
  return { item: { ...educationResult.education, subject, chapter, title } };
}

function cleanQuestion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Question data must be an object." };
  const educationResult = cleanEducation(body);
  if (educationResult.error) return educationResult;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const chapter = typeof body.chapter === "string" ? body.chapter.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const options = Array.isArray(body.options) ? body.options.map((option) => String(option).trim()) : [];
  const correctIndex = body.correctIndex;
  const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
  if (!subject || subject.length > 60) return { error: "Choose a subject of 1 to 60 characters." };
  if (!chapter || chapter.length > 120) return { error: "Enter a chapter of 1 to 120 characters." };
  if (topic.length > 120) return { error: "Topic names must be 120 characters or fewer." };
  if (!question || question.length > 500) return { error: "Questions must be between 1 and 500 characters." };
  if (options.length !== 4 || options.some((option) => !option || option.length > 300)) {
    return { error: "Enter exactly four answer options (each 1 to 300 characters)." };
  }
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    return { error: "Answer options must be different." };
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return { error: "Select the correct answer." };
  }
  if (explanation.length > 1000) return { error: "Explanations must be 1,000 characters or fewer." };
  return {
    questionData: {
      ...educationResult.education,
      subject,
      chapter,
      topic,
      question,
      options,
      correctIndex,
      explanation,
      sourceLabel: "Student-created"
    }
  };
}

function scoreQuiz(questions, answers) {
  if (!Array.isArray(answers) || answers.length > 100) return { error: "Quiz answers must be a list of no more than 100 answers." };
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set();
  const results = [];
  for (const answer of answers) {
    if (!answer || typeof answer.id !== "string" || !questionsById.has(answer.id)) {
      return { error: "A submitted question was not found in this quiz." };
    }
    if (seen.has(answer.id)) return { error: "Each quiz question can only be answered once." };
    if (!Number.isInteger(answer.answerIndex) || answer.answerIndex < 0 || answer.answerIndex > 3) {
      return { error: "Choose a valid option for every submitted answer." };
    }
    seen.add(answer.id);
    const question = questionsById.get(answer.id);
    const correct = answer.answerIndex === question.correct_index;
    results.push({
      id: question.id,
      correct,
      correctIndex: question.correct_index,
      explanation: question.explanation
    });
  }
  const score = results.filter((result) => result.correct).length;
  return {
    score,
    total: results.length,
    percent: results.length ? Math.round(score / results.length * 100) : 0,
    results
  };
}

module.exports = { cleanEducation, cleanMaterial, cleanChecklistItem, cleanQuestion, cleanFlashcard, scoreQuiz };
