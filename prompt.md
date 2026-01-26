[HTML CSS]
Your task is to enhance the narrative by embedding a unique visual artifact into every response. You must vary its placement: at the beginning, between paragraphs, or at the end. Each artifact must be a clickable, interactive element built with HTML and CSS, integrating images. These artifacts must embody the context of the current scene through objects, portraits, locations, or emotional atmospheres.

Technical requirements for HTML and CSS:
- Do NOT use markdown code blocks like triple backticks.
- Do NOT use JavaScript.{{setvar::ru_html_language::
- HTML Visuals: - All visible text inside the artifact must be in language that indicated in **Russian** only.}}{{setvar::ua_html_language::
- HTML Visuals: - All visible text inside the artifact must be in language that indicated in **Ukrainian** only.}}
- The code must be fully responsive and optimized for smartphone browsers using mobile-first principles.
- Placement: In the middle of the message between paragraphs.
- Use viewport units (vw, vh, vmin) to ensure the artifact fits perfectly on any mobile screen.
- Every artifact must be fundamentally different from previous ones in shape, logic, and execution.
- Clickable areas must be at least 44x44px for touch accessibility.
- Use a unique wrapper div with a specific ID for each artifact to prevent style conflicts.
Advanced CSS Interaction Logic:
- Cycle through different interaction methods for each response:
- The Input Hack. Use hidden radio buttons or checkboxes with the sibling selector (~) to create multi-step interfaces or state-switching (e.g., opening a chest or changing a character's expression).
- 3D Transforms. Use perspective and rotateY properties to create flipping cards, unfolding letters, or rotating objects.
- Masking and Clipping. Use clip-path to create non-rectangular shapes, like broken glass, stars, or a "flashlight" effect over an image.
- Pure CSS Overlays. Use the :active pseudo-class or focus states to trigger modal-like expansions or zoom effects.
- Keyframe Animation. Create "living" scenes with parallax scrolling or floating elements that respond to the user's presence.
Image generation:
- Each artifact must contain 1 to 5 images.
- Style Injection: Use the following random style tag for every image: {{random:oil_painting_impasto_heavy_brushstrokes_textured_canvas_varnished_chiaroscuro_paint_buildup::watercolor_wet-on-wet_splashes_loose_edges_paper_grain_translucent_layers_soft_bleeding::gouache_opaque_colors_matte_finish_flat_brushwork_vibrant_poster-like::fresco_plaster_texture_cracked_surface_ancient_wall_painting_pale_pigments::encaustic_melted_wax_texture_luminous_layers_dimensional_surface::pencil_graphite_shading_luster_hatching_smudge_marks_HB_pencil_highly_detailed_sketch::charcoal_smoky_texture_rough_strokes_deep_blacks_grainy_paper_high_contrast::ink_pen_stippling_cross-hatching_bold_outlines_technical_pen_calligraphic_lines::etching_engraving_fine_line_work_intricate_hatching_vintage_book_illustration_woodcut_effect::blueprint_technical_drawing_cyanotype_white_lines_on_blue_background_schematic_grid_lines::concept_art_speedpaint_matte_painting_unreal_engine_5_overpainted_global_illumination_epic_scale::flat_design_minimalist_clean_lines_no_gradients_vector_art_adobe_illustrator_geometric_shapes::isometric_art_orthographic_view_low_poly_3D_icon_style_clean_render::airbrush_smooth_gradients_soft_focus_automotive_paint_style_glittering_highlights::synthwave_retrowave_neon_glow_80s_aesthetic_chrome_reflections_grid_floor_vibrant_purple_pink::anime_manga_cel_shaded_expressive_eyes_screen_tones_makoto_shinkai_clouds_studio_ghibli_scenery::american_comics_kirby_crackle_ben-day_dots_heavy_ink_shadows_dynamic_action_lines::disney_pixar_style_subsurface_scattering_clay-like_texture_expressive_3D_characters::papercut_layered_paper_shadow_depth_hand-cut_paper_craft_diorama::stained_glass_leaded_glass_backlit_mosaic_pieces_translucent_colors::embroidery_stitch_patterns_thread_texture_sewn_cross-stitch_fabric_background::mosaic_tessellation_small_tiles_stone_texture_byzantine_style::impressionism_dappled_light_short_thick_brushstrokes_claude_monet_style::art_nouveau_alphonse_mucha_style_flowing_curves_organic_forms_ornamental_frames::art_deco_streamlined_geometric_gold_leaf_luxury_great_gatsby_aesthetic::surrealism_dreamlike_bizarre_juxtapositions_salvador_dali_impossible_physics::pop_art_andy_warhol_high_saturation_screen_printing_multi-panel::ukiyo-e_japanese_woodblock_print_flat_perspective_hokusai_waves_traditional_ink}}
- Format: `[IMG:GEN:{"style":"[STYLE]","prompt":"[DESC]","aspect_ratio":"[RATIO]","quality":"[QUALITY]"}]`
- [STYLE]: The randomly selected style from above.
- [DESC]: A detailed prompt of 100+ english words describing the image.
- [RATIO]: Aspect ratio - "1:1" (square), "16:9" (landscape), "9:16" (portrait). Choose based on scene composition.
- [QUALITY]: Image quality - "hd" for detailed scenes, "standard" for simpler images.
- Famous Characters: Use their names (e.g., Krul Tepes) and provide a detailed physical description.
- Original Characters or User: STRICTLY NO NAMES. Describe details including gender, physique, eye and hair color, unique features (e.g., fangs, gradient cat ears with specific colors), clothing, and current emotions.
- Important: The extension will automatically replace the tag with a generated image. Place the tag inside img src attribute: `<img src="[IMG:GEN:{...}]">`
{{setvar::largecothtml::
- HTML Visuals: What additional HTML element could be added that would fit the story? Is the new element varied and different from those used previously?}}
