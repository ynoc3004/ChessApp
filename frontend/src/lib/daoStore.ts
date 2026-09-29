import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { DAO_PATHS, type DaoModule, type DaoPath } from "@/lib/daoPaths";
import { firestore } from "@/lib/firebase";

export type ManagedDaoLesson = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  order: number;
  fen?: string;
  pgn?: string;
};

export type ManagedDaoModule = DaoModule & {
  id: string;
  order: number;
  lessons: ManagedDaoLesson[];
};

export type ManagedDaoPath = Omit<DaoPath, "modules"> & {
  order: number;
  modules: ManagedDaoModule[];
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `item-${Date.now()}`;
}

export function fallbackDaoPaths(): ManagedDaoPath[] {
  return DAO_PATHS.map((path, pathIndex) => ({
    ...path,
    order: pathIndex + 1,
    modules: path.modules.map((module, moduleIndex) => ({
      ...module,
      id: slugify(module.title),
      order: moduleIndex + 1,
      lessons: [],
    })),
  }));
}

function pathPayload(path: ManagedDaoPath) {
  return {
    name: path.name,
    han: path.han,
    epithet: path.epithet,
    intro: path.intro,
    doctrine: path.doctrine,
    order: path.order,
  };
}

function modulePayload(module: ManagedDaoModule) {
  return {
    title: module.title,
    subtitle: module.subtitle,
    description: module.description,
    themes: module.themes,
    puzzleTheme: module.puzzleTheme,
    order: module.order,
  };
}

async function writeDefaultTreeIfEmpty() {
  if (!firestore) return;
  const existing = await getDocs(collection(firestore, "daoPaths"));
  if (!existing.empty) return;

  for (const path of fallbackDaoPaths()) {
    await setDoc(doc(firestore, "daoPaths", path.slug), pathPayload(path));
    for (const module of path.modules) {
      await setDoc(
        doc(firestore, "daoPaths", path.slug, "modules", module.id),
        modulePayload(module),
      );
    }
  }
}

export async function loadDaoPaths(): Promise<ManagedDaoPath[]> {
  if (!firestore) return fallbackDaoPaths();

  const pathSnapshot = await getDocs(collection(firestore, "daoPaths"));
  if (pathSnapshot.empty) return fallbackDaoPaths();

  const paths = await Promise.all(
    pathSnapshot.docs.map(async (pathDoc) => {
      const pathData = pathDoc.data();
      const moduleSnapshot = await getDocs(
        collection(firestore!, "daoPaths", pathDoc.id, "modules"),
      );

      const modules = await Promise.all(
        moduleSnapshot.docs.map(async (moduleDoc) => {
          const moduleData = moduleDoc.data();
          const lessonSnapshot = await getDocs(
            collection(
              firestore!,
              "daoPaths",
              pathDoc.id,
              "modules",
              moduleDoc.id,
              "lessons",
            ),
          );
          const lessons = lessonSnapshot.docs
            .map((lessonDoc) => ({
              id: lessonDoc.id,
              title: String(lessonDoc.data().title ?? "Bài chưa đặt tên"),
              subtitle: String(lessonDoc.data().subtitle ?? ""),
              description: String(lessonDoc.data().description ?? ""),
              order: Number(lessonDoc.data().order ?? 999),
              fen: lessonDoc.data().fen ? String(lessonDoc.data().fen) : undefined,
              pgn: lessonDoc.data().pgn ? String(lessonDoc.data().pgn) : undefined,
            }))
            .sort((a, b) => a.order - b.order);

          return {
            id: moduleDoc.id,
            title: String(moduleData.title ?? "Môn chưa đặt tên"),
            subtitle: String(moduleData.subtitle ?? ""),
            description: String(moduleData.description ?? ""),
            themes: Array.isArray(moduleData.themes)
              ? moduleData.themes.map(String)
              : [],
            puzzleTheme: String(moduleData.puzzleTheme ?? ""),
            order: Number(moduleData.order ?? 999),
            lessons,
          } satisfies ManagedDaoModule;
        }),
      );

      return {
        slug: pathDoc.id,
        name: String(pathData.name ?? pathDoc.id),
        han: String(pathData.han ?? ""),
        epithet: String(pathData.epithet ?? ""),
        intro: String(pathData.intro ?? ""),
        doctrine: String(pathData.doctrine ?? ""),
        order: Number(pathData.order ?? 999),
        modules: modules.sort((a, b) => a.order - b.order),
      } satisfies ManagedDaoPath;
    }),
  );

  return paths.sort((a, b) => a.order - b.order);
}

export async function seedDaoPaths() {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  const defaults = fallbackDaoPaths();
  for (const path of defaults) {
    await setDoc(doc(firestore, "daoPaths", path.slug), pathPayload(path), { merge: true });
    for (const module of path.modules) {
      await setDoc(
        doc(firestore, "daoPaths", path.slug, "modules", module.id),
        modulePayload(module),
        { merge: true },
      );
    }
  }
  return defaults.length;
}

export async function saveDaoPath(path: ManagedDaoPath) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  await writeDefaultTreeIfEmpty();
  await setDoc(
    doc(firestore, "daoPaths", path.slug),
    pathPayload(path),
    { merge: true },
  );
}

export async function saveDaoModule(pathSlug: string, module: ManagedDaoModule) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  await writeDefaultTreeIfEmpty();
  await setDoc(
    doc(firestore, "daoPaths", pathSlug, "modules", module.id),
    modulePayload(module),
    { merge: true },
  );
}

export async function saveDaoLesson(
  pathSlug: string,
  moduleId: string,
  lesson: ManagedDaoLesson,
) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  await writeDefaultTreeIfEmpty();
  await setDoc(
    doc(
      firestore,
      "daoPaths",
      pathSlug,
      "modules",
      moduleId,
      "lessons",
      lesson.id,
    ),
    lesson,
    { merge: true },
  );
}

export async function deleteDaoLesson(
  pathSlug: string,
  moduleId: string,
  lessonId: string,
) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  await deleteDoc(
    doc(
      firestore,
      "daoPaths",
      pathSlug,
      "modules",
      moduleId,
      "lessons",
      lessonId,
    ),
  );
}

export async function deleteDaoModule(pathSlug: string, moduleId: string) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  const lessons = await getDocs(
    collection(
      firestore,
      "daoPaths",
      pathSlug,
      "modules",
      moduleId,
      "lessons",
    ),
  );
  await Promise.all(lessons.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(doc(firestore, "daoPaths", pathSlug, "modules", moduleId));
}

export async function deleteDaoPath(pathSlug: string) {
  if (!firestore) throw new Error("Firebase chưa được cấu hình.");
  const modules = await getDocs(
    collection(firestore, "daoPaths", pathSlug, "modules"),
  );
  for (const module of modules.docs) {
    await deleteDaoModule(pathSlug, module.id);
  }
  await deleteDoc(doc(firestore, "daoPaths", pathSlug));
}

export function makeModuleId(title: string) {
  return slugify(title);
}

export function makeLessonId(title: string) {
  return slugify(title);
}
