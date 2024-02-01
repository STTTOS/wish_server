export interface Comment {
  content: string;
  articleId: number;
  authorId: number;
  parentCommentId: number | null;
}