import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanList(value: unknown) {
  if (Array.isArray(value)) return value.map((v) => cleanText(v)).filter(Boolean).join(", ");
  return cleanText(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ ok: false, message: "Please sign in again before inviting staff." }, 401);

    const body = await req.json();
    const email = cleanText(body.email).toLowerCase();
    const full_name = cleanText(body.full_name);
    const phone = cleanText(body.phone);
    const role = ["teacher", "finance", "headteacher", "admin"].includes(cleanText(body.role)) ? cleanText(body.role) : "teacher";
    const tsc_number = cleanText(body.tsc_number);
    const qualification = cleanText(body.qualification);
    const specialisation = cleanText(body.specialisation);
    const date_joined = cleanText(body.date_joined) || null;
    const subjects_taught = cleanList(body.subjects_taught);
    const classes_taught = cleanList(body.classes_taught);
    const streams_taught = cleanText(body.streams_taught);
    const is_class_teacher = body.is_class_teacher === true || body.is_class_teacher === "true" || body.is_class_teacher === "on";
    const class_teacher_grade = cleanText(body.class_teacher_grade);
    const class_teacher_stream = cleanText(body.class_teacher_stream);

    if (!email || !full_name) {
      return json({ ok: false, message: "Enter the teacher name and email address." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
    const caller = callerRes?.user;
    if (callerErr || !caller) return json({ ok: false, message: "Your session expired. Please sign in again." }, 401);

    const { data: callerProfile, error: profileErr } = await admin
      .from("users")
      .select("id,school_id,role,email")
      .eq("id", caller.id)
      .maybeSingle();
    if (profileErr || !callerProfile?.school_id) {
      return json({ ok: false, message: "Your account is not linked to a school." }, 403);
    }
    if (!["admin", "headteacher"].includes(callerProfile.role)) {
      return json({ ok: false, message: "Only the school admin or head teacher can invite staff." }, 403);
    }

    const { data: school } = await admin
      .from("schools")
      .select("id,name,school_code")
      .eq("id", callerProfile.school_id)
      .maybeSingle();
    if (!school) return json({ ok: false, message: "School not found." }, 404);

    const metadata = {
      full_name,
      phone,
      role,
      school_id: school.id,
      school_code: school.school_code,
      invited_by: callerProfile.email,
    };

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: metadata,
      redirectTo: req.headers.get("origin") || undefined,
    });
    if (inviteErr && !String(inviteErr.message || "").toLowerCase().includes("already")) {
      return json({ ok: false, message: inviteErr.message }, 400);
    }

    let invitedUserId = inviteData?.user?.id || null;
    if (!invitedUserId) {
      const { data: existingProfile } = await admin
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      invitedUserId = existingProfile?.id || null;
    }
    if (invitedUserId) {
      await admin.from("users").upsert({
        id: invitedUserId,
        email,
        full_name,
        phone: phone || null,
        role,
        school_id: school.id,
      }, { onConflict: "id" });
    }

    const teacherRecord = {
      school_id: school.id,
      user_id: invitedUserId,
      full_name,
      email,
      phone: phone || null,
      tsc_number: tsc_number || null,
      qualification: qualification || null,
      specialisation: specialisation || null,
      system_role: role,
      subjects_taught: subjects_taught || null,
      classes_taught: classes_taught || null,
      streams_taught: streams_taught || null,
      is_class_teacher,
      class_teacher_grade: is_class_teacher ? class_teacher_grade || null : null,
      class_teacher_stream: is_class_teacher ? class_teacher_stream || null : null,
      date_joined,
      employment_status: "active",
    };

    const { data: existingTeacher } = await admin
      .from("teachers")
      .select("id")
      .eq("school_id", school.id)
      .eq("email", email)
      .maybeSingle();
    const teacherQuery = existingTeacher?.id
      ? admin.from("teachers").update(teacherRecord).eq("id", existingTeacher.id)
      : admin.from("teachers").insert(teacherRecord);
    const { error: teacherErr } = await teacherQuery;
    if (teacherErr) return json({ ok: false, message: teacherErr.message }, 400);

    return json({
      ok: true,
      message: inviteErr ? "Staff record saved. This email already exists, so ask the teacher to use forgot password if needed." : "Invitation sent. The teacher should open the email and create a password.",
      school: school.name,
      user_id: invitedUserId,
    });
  } catch (error) {
    return json({ ok: false, message: error instanceof Error ? error.message : "Invitation failed." }, 500);
  }
});
