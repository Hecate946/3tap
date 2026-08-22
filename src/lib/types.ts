export type MarkValue = 0 | 1 | 2;

export type Habit = {
  id: string;
  name: string;
  position: number;
};

export type Entry = {
  habitId: string;
  date: string;
  value: 1 | 2;
  updatedAt: string;
};

export type Board = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  habits: Habit[];
  entries: Entry[];
};

export type Credentials = {
  boardId: string;
  secret: string;
};
