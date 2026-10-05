const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanMaterial,
  cleanChecklistItem,
  cleanFlashcard,
  cleanQuestion,
  scoreQuiz
} = require("../study-materials");

test("flashcards require an organized subject, chapter, question, and answer", () => {
  const valid = cleanFlashcard({
    subject: "Biology",
    chapter: "Cells",
    question: "What is the cell membrane?",
    answer: "A selectively permeable boundary around a cell."
  });
  assert.equal(valid.flashcard.subject, "Biology");
  assert.match(cleanFlashcard({ ...valid.flashcard, question: "" }).error, /questions/);
  assert.match(cleanFlashcard({ ...valid.flashcard, answer: "" }).error, /answers/);
});

test("materials require valid academic organization and student-written text", () => {
  const valid = cleanMaterial({
    educationLevel: "college",
    course: "BCA",
    semester: 3,
    subject: "Programming",
    chapter: "Functions",
    title: "My notes",
    type: "notes",
    content: "Function basics"
  });
  assert.equal(valid.material.sourceLabel, "Student-created");
  assert.equal(valid.material.semester, 3);
  assert.equal(cleanMaterial({ ...valid.material, title: "", content: "text" }).error, "Material titles must be between 1 and 120 characters.");
  assert.match(cleanMaterial({ ...valid.material, semester: 17 }).error, /semester/);
  assert.match(cleanMaterial({ ...valid.material, content: " " }).error, /1 to 20,000/);
});

test("school material validates class range and chapter checklist fields", () => {
  const invalid = cleanMaterial({
    educationLevel: "school", classLevel: 5, subject: "Science", chapter: "Cells",
    title: "Notes", type: "notes", content: "Cell structure"
  });
  assert.match(invalid.error, /class from 6 to 12/);
  assert.equal(cleanChecklistItem({ educationLevel: "school", classLevel: 10, subject: "Math", chapter: "Algebra", title: "Review formulas" }).item.title, "Review formulas");
  assert.match(cleanChecklistItem({ educationLevel: "school", classLevel: 10, subject: "", chapter: "", title: "" }).error, /subject/);
});

test("question validation requires four distinct options and a numeric answer key", () => {
  const question = cleanQuestion({
    educationLevel: "school",
    classLevel: 8,
    subject: "Science",
    chapter: "Matter",
    topic: "States of matter",
    question: "Which is a state of matter?",
    options: ["Solid", "Liquid", "Gas", "All of these"],
    correctIndex: 3,
    explanation: "Matter commonly exists in these states."
  });
  assert.equal(question.questionData.correctIndex, 3);
  assert.equal(question.questionData.topic, "States of matter");
  assert.equal(question.questionData.sourceLabel, "Student-created");
  assert.match(cleanQuestion({ ...question.questionData, topic: "x".repeat(121) }).error, /Topic names/);
  assert.match(cleanQuestion({ ...question.questionData, options: ["same", "same", "third", "fourth"] }).error, /different/);
  assert.match(cleanQuestion({ ...question.questionData, correctIndex: "" }).error, /correct answer/);
});

test("quiz scoring persists actual correct counts and explanation feedback", () => {
  const questions = [
    { id: "q1", correct_index: 1, explanation: "Because two plus two is four." },
    { id: "q2", correct_index: 0, explanation: "Option A is the defined answer." }
  ];
  const result = scoreQuiz(questions, [
    { id: "q1", answerIndex: 1 },
    { id: "q2", answerIndex: 2 }
  ]);
  assert.equal(result.score, 1);
  assert.equal(result.total, 2);
  assert.equal(result.percent, 50);
  assert.deepEqual(result.results.map((answer) => answer.correct), [true, false]);
  assert.equal(result.results[1].explanation, "Option A is the defined answer.");
});

test("quiz scoring rejects invalid, duplicate, and unknown submissions", () => {
  const questions = [{ id: "q1", correct_index: 0, explanation: "" }];
  assert.match(scoreQuiz(questions, [{ id: "missing", answerIndex: 0 }]).error, /not found/);
  assert.match(scoreQuiz(questions, [{ id: "q1", answerIndex: 0 }, { id: "q1", answerIndex: 0 }]).error, /once/);
  assert.match(scoreQuiz(questions, [{ id: "q1", answerIndex: 4 }]).error, /valid option/);
});
